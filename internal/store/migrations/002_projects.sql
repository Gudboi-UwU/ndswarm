CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE TABLE environments (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  config_json TEXT    NOT NULL -- model.Environment with secret values encrypted
);

CREATE INDEX environments_project_id ON environments (project_id);

CREATE TABLE tests (
  id             INTEGER PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  environment_id INTEGER REFERENCES environments (id) ON DELETE SET NULL,
  name           TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  config_json    TEXT    NOT NULL, -- {"flows": [...]}
  updated_at     INTEGER NOT NULL
);

CREATE INDEX tests_project_id ON tests (project_id);
